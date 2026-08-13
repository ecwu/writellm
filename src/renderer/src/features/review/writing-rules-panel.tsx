import type { ManuscriptWorkspace } from '../../../../shared/contracts/manuscript'
import {
  readWritingRules,
  type ModelWritingRuleOperation,
  type WritingRule,
  type WritingRuleCategory
} from '../../../../shared/contracts/writing-rules'
import { useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const categories: WritingRuleCategory[] = [
  'terminology',
  'translation',
  'style',
  'academic',
  'evidence',
  'other'
]

export function WritingRulesPanel(props: {
  projectSessionId: string
  workspace: ManuscriptWorkspace | undefined
  onWorkspace(workspace: ManuscriptWorkspace): void
  onError(message: string): void
}): React.JSX.Element {
  const rules =
    props.workspace === undefined ? [] : readWritingRules(props.workspace.brief.extensible).rules
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [category, setCategory] = useState<WritingRuleCategory>('other')
  const [preferred, setPreferred] = useState('')
  const [discouraged, setDiscouraged] = useState('')
  const [rationale, setRationale] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const selected = rules.find((rule) => rule.ruleId === selectedId) ?? null
  const mutate = async (operations: ModelWritingRuleOperation[]): Promise<boolean> => {
    if (props.workspace === undefined) return false
    setBusy(true)
    try {
      props.onWorkspace(
        await window.desktop.review.updateWritingRules({
          projectSessionId: props.projectSessionId,
          baseBriefVersion: props.workspace.brief.version,
          operations
        })
      )
      return true
    } catch {
      props.onError(
        'Writing Rules changed elsewhere or the update exceeds its safe limits. Refresh and retry.'
      )
      return false
    } finally {
      setBusy(false)
    }
  }
  const add = (): void => {
    if (!instruction.trim()) return
    void mutate([
      {
        type: 'add',
        clientRef: crypto.randomUUID(),
        rule: {
          category,
          instruction: instruction.trim(),
          preferredForm: preferred.trim() || null,
          discouragedForms: discouraged
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          rationale: rationale.trim() || null,
          active: true
        }
      }
    ]).then((succeeded) => {
      if (!succeeded) return
      setInstruction('')
      setPreferred('')
      setDiscouraged('')
      setRationale('')
    })
  }
  return (
    <div
      className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
      data-testid='writing-rules-panel'
    >
      <div className='flex flex-col gap-3 border-b p-4'>
        <FieldGroup className='gap-3'>
          <Field>
            <FieldLabel htmlFor='new-writing-rule'>New rule</FieldLabel>
            <Textarea
              id='new-writing-rule'
              rows={3}
              maxLength={4_096}
              disabled={busy}
              value={instruction}
              placeholder='Write one clear instruction…'
              onChange={(event) => setInstruction(event.target.value)}
            />
            <FieldDescription>
              This reviewed Brief rule is included in future Agent writing context.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <Button variant='ghost' size='sm' className='w-full min-w-0 justify-between'>
              <span className='truncate'>Advanced terminology fields</span>
              <ChevronDown
                data-icon='inline-end'
                className={cn('transition-transform', advanced && 'rotate-180')}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className='pt-2'>
            <RuleFields
              idPrefix='new-writing-rule'
              category={category}
              instruction={null}
              preferred={preferred}
              discouraged={discouraged}
              rationale={rationale}
              disabled={busy}
              onCategory={setCategory}
              onPreferred={setPreferred}
              onDiscouraged={setDiscouraged}
              onRationale={setRationale}
            />
          </CollapsibleContent>
        </Collapsible>
        <Button size='sm' disabled={busy || !instruction.trim()} onClick={add}>
          {busy ? <Spinner data-icon='inline-start' /> : <Plus data-icon='inline-start' />}
          {busy ? 'Adding…' : 'Add rule'}
        </Button>
      </div>
      <ScrollArea className='min-h-0 flex-1'>
        {rules.length === 0 ? (
          <Empty className='border-0 p-5'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Plus />
              </EmptyMedia>
              <EmptyTitle className='text-sm'>No Writing Rules</EmptyTitle>
              <EmptyDescription>
                Add one instruction here, or tell the Agent a convention in the normal conversation.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <ItemGroup className='gap-1 p-2'>
          {rules.map((rule) => (
            <RuleItem
              key={rule.ruleId}
              rule={rule}
              selected={selectedId === rule.ruleId}
              busy={busy}
              onSelect={() => setSelectedId(rule.ruleId)}
              onToggle={(active) =>
                void mutate([{ type: 'setActive', ruleId: rule.ruleId, active }])
              }
            />
          ))}
        </ItemGroup>
        {selected !== null ? (
          <>
            <Separator />
            <RuleEditor
              key={`${selected.ruleId}:${selected.instruction}`}
              rule={selected}
              busy={busy}
              onSave={(changes) =>
                void mutate([{ type: 'update', ruleId: selected.ruleId, changes }])
              }
              onRemove={() =>
                void mutate([{ type: 'remove', ruleId: selected.ruleId }]).then((succeeded) => {
                  if (succeeded) setSelectedId(null)
                })
              }
            />
          </>
        ) : null}
      </ScrollArea>
    </div>
  )
}

function RuleItem(props: {
  rule: WritingRule
  selected: boolean
  busy: boolean
  onSelect(): void
  onToggle(active: boolean): void
}): React.JSX.Element {
  return (
    <Item size='sm' variant={props.selected ? 'muted' : 'default'}>
      <button type='button' className='min-w-0 flex-1 text-left' onClick={props.onSelect}>
        <ItemContent>
          <ItemTitle className='line-clamp-2'>{props.rule.instruction}</ItemTitle>
          <ItemDescription>
            <Badge variant='outline'>{props.rule.category}</Badge>
            {props.rule.preferredForm ? ` · ${props.rule.preferredForm}` : ''}
          </ItemDescription>
        </ItemContent>
      </button>
      <Switch
        aria-label={`${props.rule.active ? 'Deactivate' : 'Activate'} rule`}
        checked={props.rule.active}
        disabled={props.busy}
        onCheckedChange={props.onToggle}
      />
    </Item>
  )
}

function RuleEditor(props: {
  rule: WritingRule
  busy: boolean
  onSave(changes: Partial<Omit<WritingRule, 'ruleId'>>): void
  onRemove(): void
}): React.JSX.Element {
  const [instruction, setInstruction] = useState(props.rule.instruction)
  const [category, setCategory] = useState(props.rule.category)
  const [preferred, setPreferred] = useState(props.rule.preferredForm ?? '')
  const [discouraged, setDiscouraged] = useState(props.rule.discouragedForms.join(', '))
  const [rationale, setRationale] = useState(props.rule.rationale ?? '')
  return (
    <section className='flex flex-col gap-3 p-4' aria-label='Edit Writing Rule'>
      <h3 className='font-medium'>Edit rule</h3>
      <RuleFields
        idPrefix={`edit-writing-rule-${props.rule.ruleId}`}
        category={category}
        instruction={instruction}
        preferred={preferred}
        discouraged={discouraged}
        rationale={rationale}
        disabled={props.busy}
        onCategory={setCategory}
        onInstruction={setInstruction}
        onPreferred={setPreferred}
        onDiscouraged={setDiscouraged}
        onRationale={setRationale}
      />
      <div className='flex justify-between gap-2'>
        <Button size='sm' variant='outline' disabled={props.busy} onClick={props.onRemove}>
          <Trash2 data-icon='inline-start' /> Remove
        </Button>
        <Button
          size='sm'
          disabled={props.busy || !instruction.trim()}
          onClick={() =>
            props.onSave({
              category,
              instruction: instruction.trim(),
              preferredForm: preferred.trim() || null,
              discouragedForms: discouraged
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
              rationale: rationale.trim() || null
            })
          }
        >
          {props.busy ? <Spinner data-icon='inline-start' /> : null}
          {props.busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </section>
  )
}

function RuleFields(props: {
  idPrefix: string
  category: WritingRuleCategory
  instruction: string | null
  preferred: string
  discouraged: string
  rationale: string
  disabled: boolean
  onCategory(value: WritingRuleCategory): void
  onInstruction?(value: string): void
  onPreferred(value: string): void
  onDiscouraged(value: string): void
  onRationale(value: string): void
}): React.JSX.Element {
  return (
    <FieldGroup className='gap-3'>
      {props.instruction !== null ? (
        <Field>
          <FieldLabel htmlFor={`${props.idPrefix}-instruction`}>Instruction</FieldLabel>
          <Textarea
            id={`${props.idPrefix}-instruction`}
            rows={4}
            maxLength={4_096}
            disabled={props.disabled}
            value={props.instruction}
            onChange={(event) => props.onInstruction?.(event.target.value)}
          />
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor={`${props.idPrefix}-category`}>Category</FieldLabel>
        <Select
          value={props.category}
          disabled={props.disabled}
          onValueChange={(value) => props.onCategory(value as WritingRuleCategory)}
        >
          <SelectTrigger id={`${props.idPrefix}-category`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {categories.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${props.idPrefix}-preferred`}>Preferred form</FieldLabel>
        <Input
          id={`${props.idPrefix}-preferred`}
          maxLength={500}
          disabled={props.disabled}
          value={props.preferred}
          placeholder='Optional preferred wording'
          onChange={(event) => props.onPreferred(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${props.idPrefix}-discouraged`}>Discouraged forms</FieldLabel>
        <Input
          id={`${props.idPrefix}-discouraged`}
          disabled={props.disabled}
          value={props.discouraged}
          placeholder='Comma-separated, up to 20'
          onChange={(event) => props.onDiscouraged(event.target.value)}
        />
        <FieldDescription>Each term may contain up to 500 characters.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${props.idPrefix}-rationale`}>Rationale</FieldLabel>
        <Textarea
          id={`${props.idPrefix}-rationale`}
          rows={2}
          maxLength={4_096}
          disabled={props.disabled}
          value={props.rationale}
          placeholder='Optional context for the Agent'
          onChange={(event) => props.onRationale(event.target.value)}
        />
      </Field>
    </FieldGroup>
  )
}
