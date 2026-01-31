import { Signer } from "@aws-sdk/rds-signer";
import { STSClient, AssumeRoleWithWebIdentityCommand } from "@aws-sdk/client-sts";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

let cachedToken: string | undefined;

export async function getToken() {
  if (cachedToken) {
    return cachedToken;
  }

  const token = await fetchAuthToken();
  cachedToken = token;
  return token;
}

/**
 * Get a short-lived RDS auth token for local development
 * Uses VERCEL_OIDC_TOKEN to assume the AWS role via STS
 */
async function fetchAuthToken() {
  const credentials = await getAwsCredentialsFromOIDC();

  const signer = new Signer({
    // biome-ignore lint/style/noNonNullAssertion: PGHOST is defined in .env.local
    hostname: process.env.PGHOST!,
    port: Number(process.env.PGPORT),
    // biome-ignore lint/style/noNonNullAssertion: PGUSER is defined in .env.local
    username: process.env.PGUSER!,
    region: process.env.AWS_REGION,
    credentials,
  });

  return signer.getAuthToken();
}

/**
 * Get AWS credentials by exchanging a Vercel OIDC token via STS
 */
async function getAwsCredentialsFromOIDC() {
  const sts = new STSClient({ region: process.env.AWS_REGION });

  const { Credentials } = await sts.send(
    new AssumeRoleWithWebIdentityCommand({
      RoleArn: process.env.AWS_ROLE_ARN,
      RoleSessionName: "local-dev-session",
      WebIdentityToken: process.env.VERCEL_OIDC_TOKEN,
    })
  );

  if (!Credentials?.AccessKeyId || !Credentials?.SecretAccessKey || !Credentials?.SessionToken) {
    throw new Error("Failed to get AWS credentials from STS");
  }

  return {
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretAccessKey,
    sessionToken: Credentials.SessionToken,
  };
}
