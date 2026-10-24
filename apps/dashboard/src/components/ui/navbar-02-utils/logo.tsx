import { Link } from "../../../router";

export function Logo() {
  return (
    <Link to="/overview" className="navbar-02-logo" aria-label="AEGIS overview">
      AEGIS<span>.</span>
    </Link>
  );
}
