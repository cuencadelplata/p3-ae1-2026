import { Pool } from "pg";
import { config } from "../config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
});