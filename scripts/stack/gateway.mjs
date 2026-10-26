// Passerelle HTTP minimale imitant l'URL unique d'un projet Supabase :
//   /auth/v1/*  -> Supabase Auth (GoTrue)  sur 127.0.0.1:9999
//   /rest/v1/*  -> PostgREST               sur 127.0.0.1:3001
// Utilisée uniquement par le banc de test local sans Docker.
import http from "node:http";

const routes = [
  { prefix: "/auth/v1", port: Number(process.env.AUTH_PORT ?? 9999) },
  { prefix: "/rest/v1", port: Number(process.env.REST_PORT ?? 3001) },
];
const port = Number(process.env.GATEWAY_PORT ?? 54321);

http
  .createServer((req, res) => {
    const route = routes.find((r) => req.url.startsWith(r.prefix));
    if (!route) {
      res.writeHead(404).end("not found");
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: route.port,
        method: req.method,
        path: req.url.slice(route.prefix.length) || "/",
        headers: { ...req.headers, host: `127.0.0.1:${route.port}` },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502).end(String(e));
    });
    req.pipe(upstream);
  })
  .listen(port, "127.0.0.1", () => console.log(`gateway on :${port}`));
