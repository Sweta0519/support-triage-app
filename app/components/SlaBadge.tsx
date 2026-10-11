import { Badge } from "@/app/components/Badge";
import { slaBadgeClasses, slaBadgeLabel, type Sla } from "@/app/lib/sla";

// The first-response SLA chip ("Reply in 3h", "Overdue 2h"). Its labels are
// sentences, so Badge's word-capitalising is turned off here, once.
export function SlaBadge({ sla }: { sla: Sla }) {
  return <Badge label={slaBadgeLabel(sla)} colorClasses={slaBadgeClasses(sla.state)} capitalize={false} />;
}
