import { useState } from 'react'
import { BookOpen, Download, GitBranch, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import type {
  InspectGithubSkillResult,
  InstalledSkill,
  SkillsSnapshot,
  SkillUpdateResult
} from '../../../../shared/contracts/skills'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'

export function WritingSkillsSettings({
  snapshot,
  closeAction,
  onSnapshot,
  onError
}: {
  snapshot: SkillsSnapshot
  closeAction: React.ReactNode
  onSnapshot: (snapshot: SkillsSnapshot) => void
  onError: (message: string) => void
}): React.JSX.Element {
  const [repository, setRepository] = useState('')
  const [directory, setDirectory] = useState('')
  const [inspection, setInspection] = useState<InspectGithubSkillResult | null>(null)
  const [updateChecks, setUpdateChecks] = useState<Record<string, SkillUpdateResult>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const perform = async (key: string, operation: () => Promise<SkillsSnapshot>): Promise<void> => {
    setBusy(key)
    try {
      onSnapshot(await operation())
    } catch (cause) {
      onError(
        skillOperationMessage(
          cause,
          'Writing skill operation failed. Check the skill status and try again.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  const checkUpdate = async (skillId: string): Promise<void> => {
    setBusy(skillId)
    try {
      const result = await window.desktop.skills.checkUpdate({
        skillId,
        operationId: crypto.randomUUID()
      })
      setUpdateChecks((current) => ({ ...current, [skillId]: result }))
    } catch (cause) {
      onError(
        skillOperationMessage(
          cause,
          'Update check failed. Check the network connection and try again.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  const inspect = async (): Promise<void> => {
    setBusy('inspect')
    setInspection(null)
    try {
      setInspection(
        await window.desktop.skills.inspectGithub({
          repository: repository.trim(),
          directory: directory.trim() || '.',
          operationId: crypto.randomUUID()
        })
      )
    } catch (cause) {
      onError(
        skillOperationMessage(
          cause,
          'GitHub skill could not be inspected. Verify the public repository and directory.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <ScrollArea className='h-full'>
      <div className='mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 lg:p-8'>
        <header className='flex items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <h2 className='text-xl font-semibold'>Writing Skills</h2>
            <p className='max-w-[72ch] text-sm text-muted-foreground'>
              Install global, read-only writing guidance. Skills cannot add tools, execute code, or
              read project files.
            </p>
          </div>
          {closeAction}
        </header>

        <section className='flex flex-col gap-3' aria-labelledby='installed-skills-title'>
          <div>
            <h3 id='installed-skills-title' className='font-medium'>
              Installed
            </h3>
            <p className='text-sm text-muted-foreground'>
              Enabled skills are available to Auto and the Agent composer.
            </p>
          </div>
          {snapshot.installed.length === 0 ? (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <BookOpen />
                </EmptyMedia>
                <EmptyTitle>No writing skills installed</EmptyTitle>
                <EmptyDescription>
                  Install a reviewed skill below or inspect a GitHub skill.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className='gap-2'>
              {snapshot.installed.map((skill) => (
                <InstalledSkillItem
                  key={skill.skillId}
                  skill={skill}
                  dependents={snapshot.installed
                    .filter((candidate) => candidate.dependencies.includes(skill.skillId))
                    .map((candidate) => candidate.displayName)}
                  busy={busy === skill.skillId}
                  updateCheck={
                    updateChecks[skill.skillId]?.currentCommit === skill.commit
                      ? (updateChecks[skill.skillId] ?? null)
                      : null
                  }
                  onCheck={() => void checkUpdate(skill.skillId)}
                  onEnabled={(enabled, cascade) =>
                    perform(skill.skillId, () =>
                      window.desktop.skills.setEnabled({ skillId: skill.skillId, enabled, cascade })
                    )
                  }
                  onUpdate={(confirmUnreviewed) =>
                    perform(skill.skillId, async () => {
                      const next = await window.desktop.skills.update({
                        skillId: skill.skillId,
                        confirmUnreviewed,
                        operationId: crypto.randomUUID()
                      })
                      const updated = next.installed.find(
                        (candidate) => candidate.skillId === skill.skillId
                      )
                      if (skill.source === 'github' && updated !== undefined) {
                        // Keep the row on "Latest pinned" after the pin moves instead of
                        // falling back to a never-checked "Update" state.
                        setUpdateChecks((current) => ({
                          ...current,
                          [skill.skillId]: {
                            skillId: skill.skillId,
                            available: false,
                            kind: null,
                            currentCommit: updated.commit,
                            nextCommit: null
                          }
                        }))
                      }
                      return next
                    })
                  }
                  onUninstall={(cascade) =>
                    perform(skill.skillId, () =>
                      window.desktop.skills.uninstall({ skillId: skill.skillId, cascade })
                    )
                  }
                />
              ))}
            </ItemGroup>
          )}
        </section>

        <section className='flex flex-col gap-3' aria-labelledby='available-skills-title'>
          <div>
            <h3 id='available-skills-title' className='font-medium'>
              Available
            </h3>
            <p className='text-sm text-muted-foreground'>
              Pins and file allowlists are reviewed with the application release.
            </p>
          </div>
          <ItemGroup className='gap-2'>
            {snapshot.available.map((skill) => (
              <Item key={skill.skillId} variant='outline'>
                <ItemContent>
                  <ItemTitle>
                    {skill.displayName}
                    <Badge variant='secondary'>{skill.license}</Badge>
                  </ItemTitle>
                  <ItemDescription>{skill.description}</ItemDescription>
                  <p className='text-xs text-muted-foreground'>
                    {skill.repository} · {skill.commit.slice(0, 8)}
                    {skill.dependencies.length > 0
                      ? ` · Requires ${skill.dependencies.join(', ')}`
                      : ''}
                  </p>
                </ItemContent>
                <ItemActions>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={skill.installed || busy !== null}
                    onClick={() =>
                      perform(skill.skillId, () =>
                        window.desktop.skills.install({
                          source: 'curated',
                          skillId: skill.skillId,
                          operationId: crypto.randomUUID()
                        })
                      )
                    }
                  >
                    {busy === skill.skillId ? <Spinner /> : <Download data-icon='inline-start' />}
                    {skill.installed ? 'Installed' : 'Install'}
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </section>

        <section className='flex flex-col gap-3' aria-labelledby='github-skill-title'>
          <div>
            <h3 id='github-skill-title' className='font-medium'>
              Add from GitHub
            </h3>
            <p className='text-sm text-muted-foreground'>
              Public GitHub skills use trust on first use and are not reviewed by WriteLLM.
            </p>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='skill-repository'>Repository</FieldLabel>
              <Input
                id='skill-repository'
                value={repository}
                placeholder='owner/repository'
                onChange={(event) => {
                  setRepository(event.target.value)
                  setInspection(null)
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='skill-directory'>Skill directory</FieldLabel>
              <Input
                id='skill-directory'
                value={directory}
                placeholder='path/to/skill (optional)'
                onChange={(event) => {
                  setDirectory(event.target.value)
                  setInspection(null)
                }}
              />
              <FieldDescription>
                Leave empty when SKILL.md is at the repository root.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div>
            <Button
              variant='outline'
              disabled={repository.trim().length === 0 || busy !== null}
              onClick={() => void inspect()}
            >
              {busy === 'inspect' ? <Spinner /> : <GitBranch data-icon='inline-start' />}
              Inspect GitHub skill
            </Button>
          </div>
          {inspection ? (
            <Alert>
              <ShieldAlert />
              <AlertTitle>{inspection.name}</AlertTitle>
              <AlertDescription>
                <span className='block'>{inspection.description}</span>
                <span className='mt-2 block'>
                  Commit {inspection.commit.slice(0, 8)} · {inspection.fileCount} files ·{' '}
                  {inspection.totalBytes.toLocaleString()} bytes ·{' '}
                  {inspection.license ?? 'License not detected'}
                </span>
                <Button
                  className='mt-3'
                  size='sm'
                  disabled={busy !== null}
                  onClick={() =>
                    perform('github-install', async () => {
                      const next = await window.desktop.skills.install({
                        source: 'github',
                        inspectionId: inspection.inspectionId,
                        operationId: crypto.randomUUID()
                      })
                      setInspection(null)
                      return next
                    })
                  }
                >
                  {busy === 'github-install' ? <Spinner /> : <Download data-icon='inline-start' />}
                  Confirm and install
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </section>
      </div>
    </ScrollArea>
  )
}

function InstalledSkillItem({
  skill,
  dependents,
  busy,
  updateCheck,
  onCheck,
  onEnabled,
  onUpdate,
  onUninstall
}: {
  skill: InstalledSkill
  dependents: string[]
  busy: boolean
  updateCheck: SkillUpdateResult | null
  onCheck: () => void
  onEnabled: (enabled: boolean, cascade: boolean) => Promise<void>
  onUpdate: (confirmUnreviewed: boolean) => Promise<void>
  onUninstall: (cascade: boolean) => Promise<void>
}): React.JSX.Element {
  const [confirmation, setConfirmation] = useState<
    'disable-dependents' | 'uninstall-dependents' | 'unreviewed-update' | null
  >(null)
  const unavailable = skill.displayStatus.startsWith('unavailable_')
  const statusLabel =
    skill.displayStatus === 'ready'
      ? 'Ready'
      : skill.displayStatus === 'disabled'
        ? 'Disabled'
        : skill.displayStatus === 'unavailable_missing_files'
          ? 'Unavailable · Missing files'
          : 'Unavailable · Integrity check failed'
  const confirmationCopy =
    confirmation === 'unreviewed-update'
      ? {
          title: 'Install an unreviewed update?',
          description:
            'WriteLLM will pin the current upstream commit after you confirm. Its contents have not been reviewed with this application release.',
          action: 'Install update'
        }
      : confirmation === 'disable-dependents'
        ? {
            title: 'Disable dependent skills?',
            description: `This also disables ${dependents.join(', ')}.`,
            action: 'Disable all'
          }
        : {
            title: 'Uninstall dependent skills?',
            description: `This also uninstalls ${dependents.join(', ')}.`,
            action: 'Uninstall all'
          }
  const confirm = async (): Promise<void> => {
    const action = confirmation
    setConfirmation(null)
    if (action === 'unreviewed-update') await onUpdate(true)
    else if (action === 'disable-dependents') await onEnabled(false, true)
    else if (action === 'uninstall-dependents') await onUninstall(true)
  }
  return (
    <>
      <Item variant={unavailable ? 'muted' : 'outline'}>
        <ItemContent>
          <ItemTitle>
            {skill.displayName}
            <Badge variant={unavailable ? 'destructive' : 'secondary'}>{statusLabel}</Badge>
          </ItemTitle>
          <ItemDescription>{skill.description}</ItemDescription>
          <p className='text-xs text-muted-foreground'>
            {skill.source === 'curated' ? 'Reviewed catalog' : 'GitHub · Unreviewed'} ·{' '}
            {skill.commit.slice(0, 8)} · {skill.license ?? 'License not detected'}
          </p>
        </ItemContent>
        <ItemActions className='flex-wrap justify-end'>
          <Switch
            aria-label={`Enable ${skill.displayName}`}
            checked={skill.enabled && !unavailable}
            disabled={busy || unavailable}
            onCheckedChange={(value) => {
              if (!value && dependents.length > 0) setConfirmation('disable-dependents')
              else void onEnabled(value, false)
            }}
          />
          {skill.source === 'github' && !unavailable ? (
            <Button size='sm' variant='ghost' disabled={busy} onClick={onCheck}>
              Check update
            </Button>
          ) : null}
          <Button
            size='sm'
            variant='outline'
            disabled={
              busy ||
              (!unavailable &&
                (skill.source === 'curated'
                  ? !skill.updateAvailable
                  : updateCheck?.available !== true))
            }
            onClick={() => {
              if (skill.source === 'github' && !unavailable) setConfirmation('unreviewed-update')
              else void onUpdate(false)
            }}
          >
            {busy ? <Spinner /> : <RefreshCw data-icon='inline-start' />}
            {unavailable
              ? 'Reinstall'
              : skill.source === 'curated'
                ? skill.updateAvailable
                  ? 'Update'
                  : 'Latest reviewed'
                : updateCheck === null || updateCheck.available
                  ? 'Update'
                  : 'Latest pinned'}
          </Button>
          <Button
            size='icon-sm'
            variant='ghost'
            aria-label={`Uninstall ${skill.displayName}`}
            disabled={busy}
            onClick={() => {
              if (dependents.length > 0) setConfirmation('uninstall-dependents')
              else void onUninstall(false)
            }}
          >
            <Trash2 />
          </Button>
        </ItemActions>
      </Item>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmationCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmationCopy.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation === 'uninstall-dependents' ? 'destructive' : 'default'}
              onClick={() => void confirm()}
            >
              {confirmationCopy.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function skillOperationMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  // Electron invoke rejections read "Error invoking remote method '…': SkillServiceError: …";
  // surface the Main-process detail instead of hiding actionable codes behind a generic toast.
  const marker = "': "
  const index = error.message.indexOf(marker)
  const detail = index === -1 ? error.message : error.message.slice(index + marker.length)
  const cleaned = detail.replace(/^SkillServiceError: /, '').trim()
  return cleaned.length > 0 ? cleaned : fallback
}
