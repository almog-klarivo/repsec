import { FormEvent, useState } from "react";
import { api } from "../api";

export function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("Sending link…");
    setDevLink(null);
    try {
      const result = await api.requestLink(email);
      setStatus(result.delivered ? "Check your email." : "Email is not configured. Use the development link.");
      setDevLink(result.devLink ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed");
    }
  }

  return (
    <div className="login">
      <form onSubmit={onSubmit}>
        <div className="brand-mark">repsec</div>
        <h1>Sign in</h1>
        <p className="lead">Magic link. Operators and clients use the same door; the role is on the membership.</p>
        <input
          type="email"
          required
          placeholder="work email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="primary" type="submit">Send link</button>
        {status ? <p className="muted">{status}</p> : null}
        {devLink ? <a href={devLink.startsWith("http") ? devLink : `${window.location.origin}${devLink}`}>Open development sign-in</a> : null}
      </form>
    </div>
  );
}
