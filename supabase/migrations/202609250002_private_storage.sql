-- Reserved private bucket. Phase 5 will add metadata-driven object policies.
-- Deliberately no object policies: even authenticated users cannot upload/read
-- until a clinical document ownership model is installed.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('medical-documents','medical-documents',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do nothing;
