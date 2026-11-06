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

1. Instala node.js
2. Crear front-end: npm create vite@latest frontend -- --template react-ts
3. Entrar a frontend con cd frontend y ejecutar:
   * npm install
   * npm run dev
4. Instalamos tailwind: npm install tailwindcss @tailwindcss/vite react-router
5. Instalando paquete de icons: npm install lucide-react @fontsource/inter

5. Instalando cognito para la pantalla de registro y login:
   npm install @aws-sdk/client-cognito-identity-provider
6. 


