import type { PersonDto } from '@diary/shared';
import { Briefcase, Cake, Mail, MessageCircle, Phone, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HintTooltip } from '@/components/common/HintTooltip';
import { Button } from '@/components/ui/button';
import { ageOn, daysUntilBirthday, formatBirthday } from '@/lib/birthday';
import { isIncompletePhone, mailtoLink, telLink, whatsappLink } from '@/lib/phone';

/* Contact actions in the profile header. Shown on web as well as native — wa.me, mailto: and tel:
   all resolve fine in a desktop browser; only the contact *import* is Android-only.

   Every action is rendered only when its field is set: an absent phone shows nothing at all. The
   single exception is a phone we can't dial internationally, which is worth surfacing precisely
   because it looks fine but silently can't open WhatsApp. */

/** Anchors, not window.open — same pattern the rest of the app uses for external links, and
    Capacitor's WebView hands them to the system (which resolves wa.me straight into WhatsApp). */
function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    </Button>
  );
}

export function ContactInfo({ person, onEdit }: { person: PersonDto; onEdit: () => void }) {
  const { t, i18n } = useTranslation();

  const whatsapp = whatsappLink(person.phone);
  const phoneNeedsFixing = isIncompletePhone(person.phone);
  const daysAway = daysUntilBirthday(person.birthday);
  const age = ageOn(person.birthday);
  const organization = [person.jobTitle, person.company].filter(Boolean).join(' · ');

  const hasActions = person.phone || person.email;
  const hasDetails = person.birthday || organization || person.aliases.length > 0;
  if (!hasActions && !hasDetails) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {hasActions && (
        <div className="flex flex-wrap items-center gap-1.5">
          {whatsapp && (
            <LinkButton href={whatsapp}>
              <MessageCircle className="size-3.5" />
              {t('people.whatsapp')}
            </LinkButton>
          )}
          {person.phone && (
            <LinkButton href={telLink(person.phone)}>
              <Phone className="size-3.5" />
              {t('people.call')}
            </LinkButton>
          )}
          {person.email && (
            <LinkButton href={mailtoLink(person.email)}>
              <Mail className="size-3.5" />
              {t('people.email')}
            </LinkButton>
          )}

          {/* Native gets no tooltip, but nothing is lost: tapping it opens the editor, where the
              phone field spells out the same "needs a country code" hint. */}
          {phoneNeedsFixing && (
            <HintTooltip content={t('people.phoneIncomplete')}>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-amber-600 dark:text-amber-400"
                onClick={onEdit}
              >
                <TriangleAlert className="size-3.5" />
                {person.phone}
              </Button>
            </HintTooltip>
          )}
        </div>
      )}

      {hasDetails && (
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          {person.aliases.length > 0 && (
            <p className="text-xs">
              {t('people.alsoKnownAs')} {person.aliases.join(', ')}
            </p>
          )}
          {person.birthday && (
            <p className="flex items-center gap-1.5">
              <Cake className="size-3.5 shrink-0" />
              <span>
                {formatBirthday(person.birthday, i18n.language)}
                {age !== null && ` · ${t('people.ageYears', { count: age })}`}
                {daysAway === 0
                  ? ` · ${t('people.birthdayToday')}`
                  : daysAway !== null && ` · ${t('people.birthdayInDays', { count: daysAway })}`}
              </span>
            </p>
          )}
          {organization && (
            <p className="flex items-center gap-1.5">
              <Briefcase className="size-3.5 shrink-0" />
              {organization}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
