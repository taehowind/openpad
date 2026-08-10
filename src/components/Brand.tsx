import Link from "next/link";
import { GraduationCap } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="AI Study 홈">
      <span className="brand-mark"><GraduationCap size={compact ? 18 : 22} /></span>
      <span className="brand-copy">
        <strong>AI STUDY</strong>
        {!compact && <small>한국동서발전 협력사 교육 보드</small>}
      </span>
    </Link>
  );
}
