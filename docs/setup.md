Requisitos previos
Una cuenta de AWS con un usuario que tenga permisos (no el root).
AWS CLI instalado y configurado con aws configure.
SAM CLI instalado. Compruébalo con sam --version.

Backend:

Pasos
1. Guarda template.yaml en una carpeta de tu proyecto, por ejemplo /infra.
2. Valida la plantilla:
bash
   sam validate --lint

output: ...\template.yaml is a valid SAM Template

3. Ejecuta
   sam build
   sam deploy


Frontend:

4. crear las variables .env.local en la carpeta frontend copiando y pegando para rellenar

VITE_AWS_REGION=..
VITE_COGNITO_CLIENT_ID=..
VITE_COGNITO_USER_POOL_ID=..
VITE_API_URL=..

5. Entrar a frontend con cd frontend y ejecutar:
   * npm install
   * npm run dev



