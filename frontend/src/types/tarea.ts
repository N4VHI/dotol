export type Tarea = {
    id_usuario: string;
    id_tarea: string;
    nombre: string;
    descripcion?: string;
    id_categoria?: string;
    categoria?: string;
    estado: string;
    creada_por_ia: boolean;
    id_propuesta?: string;
    fecha_dia?: string;
    fecha_hacer?: string;
    fecha_completada?: string;
    fecha_creacion: string;
    fecha_modificacion: string;
};