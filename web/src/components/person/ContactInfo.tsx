import type { PersonDto } from '@diary/shared';
import { Briefcase, Cake, Copy, Mail, MessageCircle, Phone, QrCode, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { HintTooltip } from '@/components/common/HintTooltip';
import { WeChatIcon } from '@/components/icons/WeChatIcon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ageOn, daysUntilBirthday, formatBirthday } from '@/lib/birthday';
import { qrcodeLoader } from '@/lib/preloaders';
import {
  isIncompletePhone,
  mailtoLink,
  telLink,
  WECHAT_APP_URL,
  whatsappLink,
} from '@/lib/phone';

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

/** Carries the WeChat ID over to the phone: scan it, and you have the ID to paste into search. */
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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(false);
    // Encodes the ID itself, not a link: there is no URL that opens a WeChat chat (see phone.ts).
    // Encoding one is exactly what made the old QR scan through to a blank page.
    void qrcodeLoader()
      .then((qrcode) => qrcode.toDataURL(wechatId, { margin: 2, width: 320 }))
      .then((url) => !cancelled && setDataUrl(url))
      .catch((err) => {
        // Surfaced, not swallowed — a silent catch here would just leave a skeleton spinning.
        console.error('wechat: QR generation failed', err);
        if (!cancelled) setFailed(true);
      });
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
          {failed ? (
            <p className="py-6 text-center text-sm text-destructive">{t('errors.unknown')}</p>
          ) : dataUrl ? (
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

/**
 * WeChat can't be deep-linked to a specific chat (see phone.ts), so "open WeChat" means: put the
 * ID on the clipboard and launch the app, ready to paste into its search box.
 */
function WeChatAction({ wechatId }: { wechatId: string }) {
  const { t } = useTranslation();
  const [qrOpen, setQrOpen] = useState(false);

  const copyId = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(wechatId);
      return true;
    } catch {
      return false;
    }
  };

  const openWeChat = async () => {
    const copied = await copyId();
    toast.info(copied ? t('people.wechatCopiedHint') : t('people.wechatSearchHint', { id: wechatId }));
    window.location.href = WECHAT_APP_URL;
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <WeChatIcon className="size-3.5" />
            {t('people.wechat')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => void openWeChat()}>
            <WeChatIcon className="size-3.5" /> {t('people.wechatOpen')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void copyId().then((copied) => copied && toast.success(t('people.wechatCopied')))
            }
          >
            <Copy className="size-3.5" /> {t('people.wechatCopyId')}
          </DropdownMenuItem>
          {/* Mainly a desktop affordance — scan it to get the ID onto the phone — but harmless
              on native, so it isn't gated. */}
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
          {person.wechatId && <WeChatAction wechatId={person.wechatId} />}

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
