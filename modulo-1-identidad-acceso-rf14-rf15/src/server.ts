import "dotenv/config";
import app from "./app";

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
    console.log(
        `M1 - Identidad y Acceso funcionando en http://localhost:${PORT}`
    );
});