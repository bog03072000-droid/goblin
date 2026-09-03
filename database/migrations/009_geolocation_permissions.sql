ALTER TABLE fingerprints ADD COLUMN geolocation_mode TEXT NOT NULL DEFAULT 'real';
ALTER TABLE fingerprints ADD COLUMN geolocation_latitude REAL NOT NULL DEFAULT 0;
ALTER TABLE fingerprints ADD COLUMN geolocation_longitude REAL NOT NULL DEFAULT 0;
ALTER TABLE fingerprints ADD COLUMN permissions_mode TEXT NOT NULL DEFAULT 'real';
