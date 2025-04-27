import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[Email] RESEND_API_KEY is not set – transformation emails will be skipped.');
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : undefined;

export async function sendTransformationEmail(to: string, previewUrl: string) {
  if (!resend) return;

  try {
    const rsp = await resend.emails.send({
      from: 'Studio Ghibli Bot <onboarding@resend.dev>',
      to,
      subject: 'Your Ghibli-style illustration is ready! 🌸',
      html: `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h2 style="color:#5a3e2b;">Thanks for trying our Ghibli Transformer!</h2>
        <p>See your transformed artwork below. If you like it, share it with friends! 🎨</p>
        <img src="${previewUrl}" alt="Ghibli illustration" style="max-width:100%; border-radius:8px;"/>
        <p style="margin-top:24px;">Enjoy your new wallpaper! ✨</p>
        <p style="font-size:12px; color:#888;">If you didn't request this, just ignore this email.</p>
      </div>
      `,
    });
    console.log('[Email] Resend accepted:', rsp);
  } catch (err) {
    console.error('[Email] Failed to send via Resend:', err);
  }
} 