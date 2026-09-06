import { server } from "./api/server.ts";
const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => console.log(`KRISHI-NEXUS backend listening on http://localhost:${port}`));
