import { Pool } from "pg";
import { config } from "../config";

const isLocal =
  config.databaseUrl.includes("localhost") ||
  config.databaseUrl.includes("127.0.0.1");

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});
