# database/

Holds Cynth's local SQLite database file (`cynth.db`) and locally-uploaded media (`uploads/`). This is the actual data store, not documentation — for the schema decision and design notes, see [../docs/03_SYSTEM_ARCHITECTURE.md](../docs/03_SYSTEM_ARCHITECTURE.md) and [../docs/06_DATABASE_DESIGN.md](../docs/06_DATABASE_DESIGN.md).

`cynth.db` is created automatically the first time the server starts (`app/server`) — it is not checked in (see `.gitignore` in this folder). Initialization code lives in [`app/server/src/shared/database/`](../app/server/src/shared/database/):

- `schema.ts` — idempotent `CREATE TABLE IF NOT EXISTS` statements for all tables.
- `seed.ts` — seeds `article_types` only if the table is empty.
- `migrations.ts` — idempotent `ALTER TABLE ... ADD COLUMN` statements for columns added after a table's first release, so existing databases catch up without losing data.
- `index.ts` — opens/creates the database, runs the schema, runs migrations, runs the seed, and is called once on server startup.

`uploads/products/` holds locally-stored product image files (Milestone 4). Only their relative file path is stored in SQLite (`product_images.file_path`) — the files themselves live here, served by the Express server at `/uploads/...`. Upload/serving code lives in [`app/server/src/features/products/products.upload.ts`](../app/server/src/features/products/products.upload.ts).

As of Milestone 4, this remains storage + straightforward CRUD only — no AI, no business logic beyond authors and products.
