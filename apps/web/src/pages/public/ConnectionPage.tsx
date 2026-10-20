import { useEffect, useState } from "react";
import { api } from "../../lib/api/client";

export function ConnectionPage() {
  const [status, setStatus] = useState("checking...");
  useEffect(() => {
    document.title = "Connection · PaServe";
    api
      .get<{ api: string; database: string }>("/health")
      .then(({ data }) => setStatus(`${data.api} / ${data.database}`))
      .catch(() => setStatus("connection failed"));
  }, []);
  return (
    <main className="connection-page">
      <h1>PaServe connection</h1>
      <p>{status}</p>
      <a href="/register">Create an account</a>
    </main>
  );
}
