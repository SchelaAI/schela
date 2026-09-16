import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";

type Props = { company: string; userName: string };

const nav = [
  ["/dashboard", "⌂", "Dashboard"],
  ["/candidates", "◎", "Candidates"],
  ["/interviews", "◫", "Interviews"],
  ["/inbox", "◌", "Inbox"],
  ["/settings/company", "⚙", "Settings"],
] as const;

export function Sidebar({ company, userName }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark">S</span><span>Schela</span></div>
      <nav className="sidebar-nav">
        {nav.map(([href, icon, label]) => <Link key={href} href={href}><span>{icon}</span>{label}</Link>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="workspace-card"><small>WORKSPACE</small><b>{company}</b><span>{userName}</span></div>
        <form action={signOut}><button type="submit" className="sidebar-signout">Sign out</button></form>
      </div>
    </aside>
  );
}
