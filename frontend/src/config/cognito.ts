import { CognitoIdentityProviderClient } from
  "@aws-sdk/client-cognito-identity-provider";

export const cognito = new CognitoIdentityProviderClient({
  region: import.meta.env.VITE_AWS_REGION,
});

export const CLIENT_ID =
  import.meta.env.VITE_COGNITO_CLIENT_ID;