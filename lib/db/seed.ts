import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { config } from "dotenv";
import { Signer } from "@aws-sdk/rds-signer";
import { awsCredentialsProvider } from "@vercel/functions/oidc";
import { Pool } from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

async function readMovieTitlesFromCSV(): Promise<string[]> {
  const movieTitles = new Set<string>();
  const csvFilePath = path.resolve(__dirname, "movies.csv");

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on("data", (row) => {
        const title = row.title?.trim();
        if (title) {
          movieTitles.add(title);
        }
      })
      .on("end", () => {
        const uniqueMovieTitles = Array.from(movieTitles);
        console.log(
          `Parsed ${uniqueMovieTitles.length} unique movies from CSV.`,
        );
        resolve(uniqueMovieTitles);
      })
      .on("error", (error) => {
        console.error("Error reading CSV file:", error);
        reject(error);
      });
  });
}

async function main() {
  const signer = new Signer({
    hostname: process.env.PGHOST!,
    port: Number(process.env.PGPORT),
    username: process.env.PGUSER!,
    region: process.env.AWS_REGION!,
    credentials: awsCredentialsProvider({
      roleArn: process.env.AWS_ROLE_ARN!,
      clientConfig: { region: process.env.AWS_REGION! },
    }),
  });
  const client = new Pool({
    host: process.env.PGHOST!,
    user: process.env.PGUSER!,
    database: process.env.PGDATABASE || "postgres",
    password: () => signer.getAuthToken(),
    port: Number(process.env.PGPORT),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const movieTitles = await readMovieTitlesFromCSV();

    console.log(`Inserting ${movieTitles.length} movies...`);

    const defaultDate = new Date("2024-12-07");
    const batchSize = 500;

    for (let i = 0; i < movieTitles.length; i += batchSize) {
      const batch = movieTitles.slice(i, i + batchSize);
      const values = batch
        .map(
          (title, idx) =>
            `(${i + idx + 1}, '${title.replace(
              /'/g,
              "''",
            )}', 0, '${defaultDate.toISOString()}')`,
        )
        .join(",");

      await client.query(
        `INSERT INTO movies (id, title, score, last_vote_time) VALUES ${values} ON CONFLICT (id) DO NOTHING`,
      );

      console.log(
        `Inserted ${Math.min(i + batchSize, movieTitles.length)} movies...`,
      );
    }

    console.log(`Successfully seeded ${movieTitles.length} movies`);
  } finally {
    client.end();
  }
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
