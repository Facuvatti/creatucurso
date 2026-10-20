import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

/** The one connection pool of the app. Every query goes through it. */
export const pool = new Pool({ connectionString });
