import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { SidebarTrigger } from '@/components/ui/sidebar';
type Props = {
  project: string;
  category: string;
  item?: string | null;
  showBack?: boolean;
  onBack?(): void;
};
export function WorkspaceLocationHeader({ project, category, item, showBack, onBack }: Props) {
  return (
    <header className="workspace-location-header sticky top-0 z-10 flex min-h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1 max-[719px]:hidden" />
      <span className="mx-2 h-4 w-px bg-border max-[719px]:hidden" aria-hidden="true" />
      {showBack && (
        <Button
          type="button"
          variant="ghost"
          className="workspace-detail-back hidden max-[719px]:inline-flex"
          onClick={onBack}
        >
          <ChevronLeft aria-hidden="true" focusable="false" />
          Back to {category}
        </Button>
      )}
      <Breadcrumb aria-label="Current workspace location" className="min-w-0">
        <BreadcrumbList className="min-w-0 flex-nowrap">
          <BreadcrumbItem className="hidden min-w-0 md:inline-flex">
            <span className="max-w-48 truncate">{project}</span>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:list-item" />
          <BreadcrumbItem>{category}</BreadcrumbItem>
          {item && <BreadcrumbSeparator />}
          {item && (
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="max-w-64 truncate">{item}</BreadcrumbPage>
            </BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
