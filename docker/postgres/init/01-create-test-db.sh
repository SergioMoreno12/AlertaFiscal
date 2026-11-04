#!/bin/sh
set -eu

# Create a separate database for integration tests. It runs only
# once, when the data volume is empty.
test_db="${POSTGRES_TEST_DB:-alertafiscal_test}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=test_db="$test_db" \
  --set=owner="$POSTGRES_USER" <<'EOSQL'
CREATE DATABASE :"test_db" OWNER :"owner";
EOSQL
