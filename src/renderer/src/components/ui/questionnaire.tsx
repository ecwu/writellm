import { Questionnaire as QuestionnairePrimitive } from '@shadcn/react/questionnaire'
import { Check } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'
import { type Button, buttonVariants } from '@/components/ui/button'

function Questionnaire({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Root>) {
  return (
    <QuestionnairePrimitive.Root
      data-slot='questionnaire'
      className={cn('cn-questionnaire flex w-full min-w-0 flex-col gap-4', className)}
      {...props}
    />
  )
}

function QuestionnaireProgress({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Progress>) {
  return (
    <QuestionnairePrimitive.Progress
      data-slot='questionnaire-progress'
      className={cn(
        'cn-questionnaire-progress min-h-[1lh] w-fit min-w-[14ch] text-xs font-medium text-muted-foreground tabular-nums',
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireItem({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Item>) {
  return (
    <QuestionnairePrimitive.Item
      data-slot='questionnaire-item'
      className={cn(
        'cn-questionnaire-item flex min-w-0 flex-col gap-3 border-0 p-0 outline-none',
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireTitle({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Title>) {
  return (
    <QuestionnairePrimitive.Title
      data-slot='questionnaire-title'
      className={cn('cn-questionnaire-title text-pretty text-sm font-semibold', className)}
      {...props}
    />
  )
}

function QuestionnaireDescription({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Description>) {
  return (
    <QuestionnairePrimitive.Description
      data-slot='questionnaire-description'
      className={cn(
        'cn-questionnaire-description text-pretty text-xs text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireChoices({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choices>) {
  return (
    <QuestionnairePrimitive.Choices
      data-slot='questionnaire-choices'
      className={cn(
        'cn-questionnaire-choices group/questionnaire-choices grid min-w-0 gap-2',
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireChoice({
  children,
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
  return (
    <QuestionnairePrimitive.Choice
      data-slot='questionnaire-choice'
      className={cn(
        'cn-questionnaire-choice group/questionnaire-choice relative flex min-h-11 cursor-pointer items-start gap-3 rounded-md border bg-background px-3 py-2.5 text-start text-sm outline-none transition-colors select-none hover:bg-accent/50 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 data-checked:border-primary data-checked:bg-accent/60 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className
      )}
      {...props}
    >
      <QuestionnairePrimitive.ChoiceInput
        data-slot='questionnaire-choice-input'
        className='cn-questionnaire-choice-input absolute inset-0 z-10 size-full cursor-pointer opacity-0'
      />
      <span
        aria-hidden='true'
        data-slot='questionnaire-choice-indicator'
        className='cn-questionnaire-choice-indicator pointer-events-none relative mt-0.5 flex size-4 shrink-0 items-center justify-center border border-input group-data-[type=radio]/questionnaire-choice:rounded-full'
      >
        <span
          data-slot='questionnaire-choice-indicator-dot'
          className='cn-questionnaire-choice-indicator-dot hidden size-2 rounded-full bg-primary group-data-[type=checkbox]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block'
        />
        <Check
          data-slot='questionnaire-choice-indicator-check'
          className='cn-questionnaire-choice-indicator-check hidden size-3 group-data-[type=radio]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block'
        />
      </span>
      <QuestionnairePrimitive.ChoiceLabel
        data-slot='questionnaire-choice-label'
        className='cn-questionnaire-choice-label cn-questionnaire-choice-content flex min-w-0 flex-1 flex-col gap-0.5 leading-snug'
      >
        {children}
      </QuestionnairePrimitive.ChoiceLabel>
      <QuestionnairePrimitive.ChoiceShortcut
        data-slot='questionnaire-choice-shortcut'
        className='cn-questionnaire-choice-shortcut cn-questionnaire-shortcut pointer-events-none ms-auto hidden shrink-0 text-xs text-muted-foreground group-data-[shortcut]/questionnaire-choice:inline-flex'
      />
    </QuestionnairePrimitive.Choice>
  )
}

function QuestionnaireChoiceDescription({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot='questionnaire-choice-description'
      className={cn('cn-questionnaire-choice-description text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function QuestionnaireInput({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Input>) {
  return (
    <div
      data-slot='questionnaire-input-wrapper'
      className='cn-questionnaire-input-wrapper group/questionnaire-input relative min-w-0'
    >
      <QuestionnairePrimitive.Input
        data-slot='questionnaire-input'
        className={cn(
          'cn-questionnaire-input min-h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow,background-color] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9',
          className
        )}
        {...props}
      />
    </div>
  )
}

function QuestionnaireError({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Error>) {
  return (
    <QuestionnairePrimitive.Error
      data-slot='questionnaire-error'
      className={cn('cn-questionnaire-error text-xs text-destructive', className)}
      {...props}
    />
  )
}

function QuestionnaireActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='questionnaire-actions'
      className={cn(
        'cn-questionnaire-actions grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2',
        className
      )}
      {...props}
    />
  )
}

type QuestionnaireNavigationProps = Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'>

function QuestionnairePrevious({
  children,
  className,
  size = 'default',
  variant = 'outline',
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Previous> & QuestionnaireNavigationProps) {
  return (
    <QuestionnairePrimitive.Previous
      data-slot='questionnaire-previous'
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        'cn-questionnaire-previous col-start-1 row-start-1 min-h-11 justify-self-start sm:min-h-0',
        className
      )}
      {...props}
    >
      {children ?? 'Previous'}
    </QuestionnairePrimitive.Previous>
  )
}

function QuestionnaireNext({
  children,
  className,
  size = 'default',
  variant = 'default',
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Next> & QuestionnaireNavigationProps) {
  return (
    <QuestionnairePrimitive.Next
      data-slot='questionnaire-next'
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        'cn-questionnaire-next col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0',
        className
      )}
      {...props}
    >
      {children ?? 'Next'}
    </QuestionnairePrimitive.Next>
  )
}

function QuestionnaireSubmit({
  children,
  className,
  size = 'default',
  variant = 'default',
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Submit> & QuestionnaireNavigationProps) {
  return (
    <QuestionnairePrimitive.Submit
      data-slot='questionnaire-submit'
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        'cn-questionnaire-submit col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0',
        className
      )}
      {...props}
    >
      {children ?? 'Submit'}
    </QuestionnairePrimitive.Submit>
  )
}

export {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle
}
