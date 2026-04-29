-- Add date_end column to chapters for multi-day events
alter table chapters add column date_end date;

-- Update Munich Match 1 (Makeathon) to 17-19 April 2026
update chapters set date_end = '2026-04-19' where slug = 'munich-1';
