import "./LicenseNote.css";

const REPO_URL = "https://github.com/openalice-org/openalice.org";

export default function LicenseNote() {
  return (
    <div className="license-note">
      <img className="license-logo" src={`${import.meta.env.BASE_URL}alice.png`} alt="OpenAlice" width={28} height={28} />
      <span>
        MIT License ·{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          Source
        </a>
      </span>
    </div>
  );
}
