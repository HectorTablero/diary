import type { PersonDto } from '@diary/shared';
import {
  Briefcase,
  Cake,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  QrCode,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ageOn, daysUntilBirthday, formatBirthday } from '@/lib/birthday';
import { isNative } from '@/lib/native';
import { qrcodeLoader } from '@/lib/preloaders';
import { isIncompletePhone, mailtoLink, telLink, wechatLink, whatsappLink } from '@/lib/phone';

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

/** The deep link is useless in a desktop browser without the WeChat client, so offer the QR too:
    scanning it from the phone opens the same chat. */
function WeChatQrDialog({
  wechatId,
  open,
  onOpenChange,
}: {
  wechatId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The QR encoder is shared with the idle preloader, so opening the dialog
    // only has to wait for the cached chunk if it already warmed.
    void qrcodeLoader()
      .then((qrcode) => qrcode.toDataURL(wechatLink(wechatId), { margin: 2, width: 320 }))
      .then((url) => !cancelled && setDataUrl(url))
      .catch(() => !cancelled && setDataUrl(null));
    return () => {
      cancelled = true;
    };
  }, [open, wechatId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{t('people.wechatQrTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          {dataUrl ? (
            <img
              src={dataUrl}
              alt={t('people.wechatQrTitle')}
              className="rounded-lg bg-white p-2"
              width={240}
              height={240}
            />
          ) : (
            <div className="size-60 animate-pulse rounded-lg bg-muted" />
          )}
          <p className="text-center text-xs text-muted-foreground">
            {t('people.wechatQrDescription')}
          </p>
          <code className="rounded bg-muted px-2 py-1 text-xs">{wechatId}</code>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WeChatAction({ wechatId }: { wechatId: string }) {
  const { t } = useTranslation();
  const [qrOpen, setQrOpen] = useState(false);

  // On the phone the deep link just works, so don't make the user pick.
  if (isNative) {
    return (
      <LinkButton href={wechatLink(wechatId)}>
        <MessageSquare className="size-3.5" />
        {t('people.wechat')}
      </LinkButton>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <MessageSquare className="size-3.5" />
            {t('people.wechat')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem asChild>
            <a href={wechatLink(wechatId)} target="_blank" rel="noreferrer">
              <MessageSquare className="size-3.5" /> {t('people.wechatOpen')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setQrOpen(true)}>
            <QrCode className="size-3.5" /> {t('people.wechatShowQr')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <WeChatQrDialog wechatId={wechatId} open={qrOpen} onOpenChange={setQrOpen} />
    </>
  );
}

export function ContactInfo({ person, onEdit }: { person: PersonDto; onEdit: () => void }) {
  const { t, i18n } = useTranslation();

  const whatsapp = whatsappLink(person.phone);
  const phoneNeedsFixing = isIncompletePhone(person.phone);
  const daysAway = daysUntilBirthday(person.birthday);
  const age = ageOn(person.birthday);
  const organization = [person.jobTitle, person.company].filter(Boolean).join(' · ');

  const hasActions = person.phone || person.email || person.wechatId;
  const hasDetails = person.birthday || organization || person.aliases.length > 0;
  if (!hasActions && !hasDetails) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {hasActions && (
        <div className="flex flex-wrap items-center gap-1.5">
          {whatsapp && (
            <LinkButton href={whatsapp}>
              <MessageCircle className="size-3.5" />
              WhatsApp
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
          {person.wechatId && <WeChatAction wechatId={person.wechatId} />}

          {phoneNeedsFixing && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-amber-600 dark:text-amber-400"
                  onClick={onEdit}
                >
                  <TriangleAlert className="size-3.5" />
                  {person.phone}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('people.phoneIncomplete')}</TooltipContent>
            </Tooltip>
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
