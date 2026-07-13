import type { PersonDto, TagDto } from '@diary/shared';
import { MAX_ALIASES } from '@diary/shared';
import { Hash, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useCreatePerson,
  useCreateTag,
  useSettings,
  useTags,
  useUpdatePerson,
} from '@/api/hooks';
import { TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/apiClient';
import { birthdayToDateInput, formatBirthdayValue, parseBirthday } from '@/lib/birthday';
import { normalizePhone, toE164 } from '@/lib/phone';
import { fuzzyEquals } from '@/lib/tokens';

interface PersonFormProps {
  person?: PersonDto | null;
  onDone: () => void;
}

/** Free-text chips for the extra names a person answers to. */
function AliasEditor({
  aliases,
  onChange,
}: {
  aliases: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value || aliases.length >= MAX_ALIASES) return;
    if (aliases.some((alias) => fuzzyEquals(alias, value))) {
      setDraft('');
      return;
    }
    onChange([...aliases, value]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="person-alias">
        {t('people.aliases')}{' '}
        <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
      </Label>
      <p className="text-xs text-muted-foreground">{t('people.aliasesDescription')}</p>
      {aliases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {aliases.map((alias) => (
            <Badge key={alias} variant="secondary" className="gap-1 pr-1">
              {alias}
              <button
                type="button"
                aria-label={t('common.remove')}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                onClick={() => onChange(aliases.filter((a) => a !== alias))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {aliases.length < MAX_ALIASES && (
        <div className="flex items-center gap-1.5">
          <Input
            id="person-alias"
            value={draft}
            placeholder={t('people.aliasPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" size="icon" disabled={!draft.trim()} onClick={add}>
            <Plus className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function PersonForm({ person = null, onDone }: PersonFormProps) {
  const { t } = useTranslation();
  const { data: allTags = [] } = useTags();
  const { data: settings } = useSettings();
  const createTag = useCreateTag();
  const createPerson = useCreatePerson();
  const updatePerson = useUpdatePerson();

  const [name, setName] = useState(person?.name ?? '');
  const [notes, setNotes] = useState(person?.notes ?? '');
  const [tags, setTags] = useState<TagDto[]>(person?.tags ?? []);
  const [aliases, setAliases] = useState<string[]>(person?.aliases ?? []);
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [phoneError, setPhoneError] = useState(false);
  const [email, setEmail] = useState(person?.email ?? '');
  const [wechatId, setWechatId] = useState(person?.wechatId ?? '');
  const [company, setCompany] = useState(person?.company ?? '');
  const [jobTitle, setJobTitle] = useState(person?.jobTitle ?? '');
  const [birthdayDate, setBirthdayDate] = useState(birthdayToDateInput(person?.birthday ?? null));
  const [birthdayHasYear, setBirthdayHasYear] = useState(
    parseBirthday(person?.birthday ?? null)?.year != null,
  );
  const [checkupEnabled, setCheckupEnabled] = useState(person?.checkupIntervalDays != null);
  const [checkupIntervalDays, setCheckupIntervalDays] = useState(person?.checkupIntervalDays ?? 30);
  // For new people, inherit the default checkup interval once settings have loaded.
  const [defaultsApplied, setDefaultsApplied] = useState(person !== null);

  useEffect(() => {
    if (defaultsApplied || !settings) return;
    setCheckupEnabled(settings.defaultCheckupIntervalDays != null);
    setCheckupIntervalDays(settings.defaultCheckupIntervalDays ?? 30);
    setDefaultsApplied(true);
  }, [defaultsApplied, settings]);

  const pending = createPerson.isPending || updatePerson.isPending;

  const toggleTag = (id: string) => {
    const tag = allTags.find((tg) => tg.id === id);
    if (!tag) return;
    setTags((prev) =>
      prev.some((tg) => tg.id === id) ? prev.filter((tg) => tg.id !== id) : [...prev, tag],
    );
  };

  const submit = async () => {
    if (!name.trim() || pending) return;

    // A number typed here must be fully international — anything less can't open a WhatsApp chat,
    // and we refuse to guess a country code. (Imported numbers bypass this and get flagged on the
    // profile instead, which routes the user back here to fix them.)
    const trimmedPhone = phone.trim();
    const e164 = toE164(trimmedPhone);
    if (trimmedPhone && !e164) {
      setPhoneError(true);
      return;
    }
    setPhoneError(false);

    const parsedBirthday = parseBirthday(birthdayDate);
    const input = {
      name: name.trim(),
      aliases,
      phone: e164,
      email: email.trim() || null,
      wechatId: wechatId.trim() || null,
      birthday: parsedBirthday
        ? formatBirthdayValue(
            birthdayHasYear ? parsedBirthday.year : null,
            parsedBirthday.month,
            parsedBirthday.day,
          )
        : null,
      company: company.trim() || null,
      jobTitle: jobTitle.trim() || null,
      contactId: person?.contactId ?? null,
      notes,
      tags: tags.map((tag) => tag.id),
      checkupIntervalDays: checkupEnabled
        ? Math.min(3650, Math.max(1, Math.round(checkupIntervalDays) || 1))
        : null,
    };
    try {
      if (person) await updatePerson.mutateAsync({ id: person.id, input });
      else await createPerson.mutateAsync(input);
      toast.success(t('people.personSaved'));
      onDone();
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
    }
  };

  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-name">{t('people.name')}</Label>
        <Input
          id="person-name"
          value={name}
          autoFocus
          placeholder={t('people.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>

      <AliasEditor aliases={aliases} onChange={setAliases} />

      <div className="flex flex-col gap-1.5">
        <Label>{t('people.tags')}</Label>
        <p className="text-xs text-muted-foreground">{t('people.tagsDescription')}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} onRemove={() => toggleTag(tag.id)} />
          ))}
          <EntityPicker
            trigger={
              <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
                <Hash className="size-3" />
                {t('common.add')}
              </Button>
            }
            items={allTags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
            selectedIds={tags.map((tag) => tag.id)}
            onToggle={toggleTag}
            onCreate={(tagName) =>
              void createTag
                .mutateAsync({ name: tagName })
                .then((tag) => setTags((prev) => [...prev, tag]))
                .catch((err) => toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown')))
            }
            placeholder={t('tags.namePlaceholder')}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t pt-4">
        <Label htmlFor="person-phone">
          {t('people.phone')}{' '}
          <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Input
          id="person-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          placeholder="+34 600 123 456"
          aria-invalid={phoneError}
          onChange={(e) => {
            setPhone(e.target.value);
            if (phoneError) setPhoneError(false);
          }}
          onBlur={() => phone.trim() && setPhone(normalizePhone(phone))}
        />
        <p className={'text-xs ' + (phoneError ? 'text-destructive' : 'text-muted-foreground')}>
          {t('people.phoneInternationalHint')}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-email">
          {t('people.email')}{' '}
          <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Input
          id="person-email"
          type="email"
          inputMode="email"
          value={email}
          placeholder="alguien@ejemplo.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-wechat">
          {t('people.wechat')}{' '}
          <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Input
          id="person-wechat"
          value={wechatId}
          placeholder={t('people.wechatPlaceholder')}
          onChange={(e) => setWechatId(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-birthday">
          {t('people.birthday')}{' '}
          <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Input
          id="person-birthday"
          type="date"
          value={birthdayDate}
          onChange={(e) => setBirthdayDate(e.target.value)}
        />
        {birthdayDate && (
          <div className="mt-1 flex items-center justify-between gap-2">
            <Label htmlFor="person-birthday-year" className="font-normal text-muted-foreground">
              {t('people.birthdayKnowYear')}
            </Label>
            <Switch
              id="person-birthday-year"
              checked={birthdayHasYear}
              onCheckedChange={setBirthdayHasYear}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="person-company">
            {t('people.company')}{' '}
            <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
          </Label>
          <Input
            id="person-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="person-job">
            {t('people.jobTitle')}{' '}
            <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
          </Label>
          <Input
            id="person-job"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="person-checkup">{t('people.checkupReminders')}</Label>
          <Switch id="person-checkup" checked={checkupEnabled} onCheckedChange={setCheckupEnabled} />
        </div>
        <p className="text-xs text-muted-foreground">{t('people.checkupRemindersDescription')}</p>
        {checkupEnabled && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('people.checkupEvery')}</span>
            <Input
              type="number"
              min={1}
              max={3650}
              step={1}
              value={checkupIntervalDays}
              onChange={(e) => setCheckupIntervalDays(e.target.valueAsNumber)}
              className="w-20"
            />
            <span className="text-xs text-muted-foreground">{t('settings.memories.days')}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-notes">
          {t('people.notes')}{' '}
          <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Textarea
          id="person-notes"
          value={notes}
          rows={3}
          placeholder={t('people.notesPlaceholder')}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} disabled={!name.trim() || pending}>
          {pending && <Spinner className="size-3.5" />}
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
