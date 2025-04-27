-- Adds hires_path column for storing high-resolution image storage path
ALTER TABLE transformations
ADD COLUMN hires_path TEXT; 