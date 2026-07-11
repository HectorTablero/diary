import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface PickerItem {
  id: string;
  label: string;
  color?: string;
}

interface EntityPickerProps {
  trigger: ReactNode;
  items: PickerItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCreate?: (name: string) => void;
  placeholder: string;
}

/** Popover + searchable list used as the explicit tag/person picker. */
export function EntityPicker({
  trigger,
  items,
  selectedIds,
  onToggle,
  onCreate,
  placeholder,
}: EntityPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = new Set(selectedIds);
  const canCreate =
    onCreate &&
    query.trim().length > 0 &&
    !items.some((i) => i.label.toLowerCase() === query.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{t('common.noResults')}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem key={item.id} value={`${item.id}:${item.label}`} onSelect={() => onToggle(item.id)}>
                  <span
                    className="mr-1 inline-block size-2 rounded-full"
                    style={{ backgroundColor: item.color ?? 'var(--muted-foreground)' }}
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {selected.has(item.id) && <span className="text-xs text-muted-foreground">✓</span>}
                </CommandItem>
              ))}
              {canCreate && (
                <CommandItem
                  value={`__create__:${query}`}
                  onSelect={() => {
                    onCreate(query.trim());
                    setQuery('');
                  }}
                >
                  <Plus className="mr-1 size-3.5" />
                  {t('diary.createTag', { name: query.trim() })}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
