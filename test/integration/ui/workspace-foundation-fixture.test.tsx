import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from '../../../src/renderer/components/patterns/EmptyState';
import { FormField } from '../../../src/renderer/components/patterns/FormField';
import { StatusNotice } from '../../../src/renderer/components/patterns/StatusNotice';
import { Badge } from '../../../src/renderer/components/ui/badge';
import { Button } from '../../../src/renderer/components/ui/button';
import { Card } from '../../../src/renderer/components/ui/card';
import { Input } from '../../../src/renderer/components/ui/input';
import { ScrollArea } from '../../../src/renderer/components/ui/scroll-area';
import { Separator } from '../../../src/renderer/components/ui/separator';

test('business-free fixture composes the accepted common UI inventory through public paths', () => {
  const html = renderToStaticMarkup(
    <Card>
      <Button aria-label="Tool">T</Button>
      <FormField label="Setting">
        <Input />
      </FormField>
      <Separator />
      <ScrollArea>
        <StatusNotice>Saved</StatusNotice>
        <Badge>Ready</Badge>
        <EmptyState title="Empty" description="Nothing yet" />
      </ScrollArea>
    </Card>,
  );
  for (const text of ['Tool', 'Setting', 'Saved', 'Ready', 'Empty']) expect(html).toContain(text);
});
