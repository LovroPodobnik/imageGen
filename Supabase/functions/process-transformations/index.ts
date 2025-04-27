/// <reference types="https://esm.sh/@supabase/functions-js/edge-runtime.d.ts" />
/* eslint-disable */
// deno-lint-ignore-file
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const openaiKey = Deno.env.get('OPENAI_API_KEY');
const resendKey = Deno.env.get('RESEND_API_KEY');
const supabase = createClient(supabaseUrl, serviceKey);
// Helper to send preview email via Resend REST API
async function sendEmail(to: string, previewUrl: string) {
  if (!resendKey) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Studio Ghibli Bot <onboarding@resend.dev>',
      to,
      subject: 'Your Ghibli-style illustration is ready! 🌸',
      html: `<p>See your transformed artwork:</p><img src="${previewUrl}" style="max-width:100%;border-radius:8px;"/>`
    })
  });
}
const prompt = `Transform the people and animals in this photo into a frame from a 2-D Studio-Ghibli film.\n\nREQUIREMENTS\n• Preserve every subject's facial features, hairstyle, clothing colours, body pose and relative positions.  \n• Colour palette: soft pastels with warm, slightly saturated highlights.  \n• Line style: thin, confident pencil strokes, subtle hatching for shading.  \n• Background: whimsical hand-painted scenery that matches the original context (e.g. forest, street, room).  \n• Lighting: gentle diffuse daylight; no harsh shadows, no lens-flare.  \n• Composition must stay faithful to the original cropping—no zoom or extra borders.  \n• No text, no watermarks, no logos.\n\nOUTPUT\n• Single illustration.`;
Deno.serve(async ()=>{
  // Fetch one queued transformation
  const { data: jobs } = await supabase.from('transformations').select('*').eq('status', 'queued').limit(1);
  if (!jobs || jobs.length === 0) return new Response('nothing to do');
  const job = jobs[0];
  // mark processing
  await supabase.from('transformations').update({
    status: 'processing'
  }).eq('id', job.id);
  
  try {
    // *** Fetch user email using job.user_id ***
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('email')
      .eq('id', job.user_id)
      .single();

    if (userError || !userData?.email) {
      throw new Error(`Failed to fetch user email for user_id ${job.user_id}: ${userError?.message ?? 'Email not found'}`);
    }
    const userEmail = userData.email;

    // create signed url for original
    // Ensure the job object actually has original_path from the select('*')
    if (!job.original_path) {
      throw new Error(`Job ${job.id} is missing original_path`);
    }
    const { data: signed } = await supabase.storage.from('uploads-original').createSignedUrl(job.original_path, 900);
    const imgResp = await fetch(signed.signedUrl);
    const imgBuf = new Uint8Array(await imgResp.arrayBuffer());
    // Build form-data for OpenAI
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    form.append('image', new Blob([
      imgBuf
    ], {
      type: 'image/png'
    }), 'input.png');
    const openResp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`
      },
      body: form
    });
    const openJson = await openResp.json();
    const b64 = openJson.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI response missing image');
    const previewBuf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    /*
      1. Save the OpenAI 1024×1024 result as the high-res version
    */
    const hiresPath = `renders-hires/${job.user_id}/${job.id}.png`;
    await supabase.storage.from('renders-hires').upload(hiresPath, previewBuf, {
      contentType: 'image/png',
      upsert: false
    });

    /*
      2. Resize to a 512-px preview using ImageScript
    */
    const img = await Image.decode(previewBuf);
    const smallImg  = img.contain(512, 512); // preserve aspect ratio using ImageScript's contain
    const smallBuf  = await smallImg.encode();   // PNG by default

    /*
      3. Upload the preview to a public bucket
    */
    const smallPath = `renders-preview-small/${job.user_id}/${job.id}.png`;
    await supabase.storage.from('renders-preview-small').upload(smallPath, smallBuf, {
      contentType: 'image/png',
      upsert: false
    });

    /*
      4. Update DB record with both paths
    */
    await supabase.from('transformations').update({
      status: 'completed',
      preview_path: smallPath,
      hires_path: hiresPath
    }).eq('id', job.id);

    /*
      5. Email the preview URL only
    */
    const { data: pub } = supabase.storage.from('renders-preview-small').getPublicUrl(smallPath);
    await sendEmail(userEmail, pub.publicUrl);
    return new Response('processed');
  } catch (e) {
    console.error('Error processing job:', e);
    await supabase.from('transformations').update({
      status: 'failed'
    }).eq('id', job.id);
    return new Response('error', {
      status: 500
    });
  }
});
