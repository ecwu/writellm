import { Button } from '@/components/ui/button';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import type { OwnerStatusSummary } from '../workspaceSession';
export function WorkspaceStatusRegion({ status }: { status: OwnerStatusSummary | null }) {
  return <section className="workspace-status" aria-label="Workspace status">{status ? <StatusNotice tone={status.severity} urgent={status.state === 'error'}><span>{status.message}</span>{status.action ? <Button type="button" size="sm" onClick={status.action.invoke}>{status.action.label}</Button> : null}</StatusNotice> : <StatusNotice>Workspace ready</StatusNotice>}</section>;
}
