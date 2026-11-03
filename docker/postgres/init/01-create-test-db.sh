#!/bin/sh
set -eu

# Crea una base independiente para pruebas de integración. Se ejecuta una sola
# vez, cuando el volumen de datos está vacío.
test_db="${POSTGRES_TEST_DB:-alertafiscal_test}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=test_db="$test_db" \
  --set=owner="$POSTGRES_USER" <<'EOSQL'
CREATE DATABASE :"test_db" OWNER :"owner";
EOSQL
