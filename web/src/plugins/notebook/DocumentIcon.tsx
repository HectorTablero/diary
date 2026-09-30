import { FileText } from 'lucide-react';
import { namedIcon } from '@/components/icons/iconCatalog';

/** A document's chosen icon. Decorative: the title beside it already names the document. */
export function DocumentIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = namedIcon(icon, FileText);
  return <Icon aria-hidden className={className} />;
}
