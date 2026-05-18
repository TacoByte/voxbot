#!/bin/bash

# Configuration
DB_NAME="voxels"
OUTPUT_FILE="import.sql"
ISLAND_NAME="Poneke"

echo "-- Generating Poneke Dev Fixture with Extensions and Schema --"

# 1. Start the file with the required extensions
cat <<EOF > $OUTPUT_FILE
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

EOF

# Dump schema for reference
pg_dump $DB_NAME -s --no-owner --no-privileges \
  | grep -v -E '^(--|SET|SELECT pg_catalog\.set_config|/\*)' \
  | sed '/^$/d' \
  > schema.sql


# 2. Dump the STRUCTURE only (no data)
# We add --no-owner and --no-privileges to make it portable for your friends
pg_dump $DB_NAME -s \
  --no-owner \
  --no-privileges \
  >> $OUTPUT_FILE

# 3. Data loading settings
cat <<EOF >> $OUTPUT_FILE
SET session_replication_role = 'replica';
BEGIN;

EOF

# Function to wrap the COPY command
dump_table() {
    local table_name=$1
    local query=$2
    
    echo "Processing data for $table_name..."
    echo "COPY public.$table_name FROM STDIN WITH (FORMAT CSV, HEADER);" >> $OUTPUT_FILE
    psql $DB_NAME -c "COPY ($query) TO STDOUT WITH (FORMAT CSV, HEADER)" >> $OUTPUT_FILE
    echo "\." >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
}

# 4. Dump the actual filtered data
dump_table "islands" "SELECT * FROM islands"
dump_table "properties" "SELECT * FROM properties WHERE island = '$ISLAND_NAME'"
dump_table "womps" "SELECT w.* FROM womps w JOIN properties p ON w.parcel_id = p.id WHERE p.island = '$ISLAND_NAME'"

# Avatars: owners of parcels or womps on this island
dump_table "avatars" "
  SELECT DISTINCT a.* FROM avatars a
  JOIN properties p ON lower(a.owner) = lower(p.owner)
  WHERE p.island = '$ISLAND_NAME'
  UNION
  SELECT DISTINCT a.* FROM avatars a
  JOIN womps w ON lower(a.owner) = lower(w.author)
  JOIN properties p ON w.parcel_id = p.id
  WHERE p.island = '$ISLAND_NAME'
"

# Updated Costumes: Ensure we get costumes for the wompers too
dump_table "costumes" "
  SELECT c.* FROM costumes c 
  WHERE LOWER(c.wallet) IN (
    SELECT DISTINCT LOWER(owner) FROM properties WHERE island = '$ISLAND_NAME'
    UNION
    SELECT DISTINCT LOWER(author) FROM womps w 
    JOIN properties p ON w.parcel_id = p.id 
    WHERE p.island = '$ISLAND_NAME'
  )
"

# 5. Wrap it up
cat <<EOF >> $OUTPUT_FILE
COMMIT;
SET session_replication_role = 'origin';
EOF

echo "-- Done! Created $OUTPUT_FILE --"
echo "Usage: createdb boop && psql boop < $OUTPUT_FILE"


