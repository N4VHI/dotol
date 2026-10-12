Requisitos previos
Una cuenta de AWS con un usuario que tenga permisos (no el root).
AWS CLI instalado y configurado con aws configure.
SAM CLI instalado. Compruébalo con sam --version.

Pasos
1. Guarda template.yaml en una carpeta de tu proyecto, por ejemplo /infra.
2. Valida la plantilla:
bash
   sam validate --lint

output: ...\template.yaml is a valid SAM Template

3. Ejecuta
   sam deploy


