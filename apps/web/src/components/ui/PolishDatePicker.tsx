import type { ReactNode, Ref } from 'react';
import dayjs from 'dayjs';
import type { SxProps, Theme } from '@mui/material/styles';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import 'dayjs/locale/pl.js';

export const polishPickerLocaleText = {
  cancelButtonLabel: 'Anuluj',
  clearButtonLabel: 'Wyczyść',
  datePickerToolbarTitle: 'Wybierz datę',
  fieldClearLabel: 'Wyczyść',
  nextMonth: 'Następny miesiąc',
  okButtonLabel: 'Zatwierdź',
  openDatePickerDialogue: (formattedDate: string | null) =>
    formattedDate ? `Wybierz datę, obecnie wybrana data to ${formattedDate}` : 'Wybierz datę',
  previousMonth: 'Poprzedni miesiąc',
  todayButtonLabel: 'Dzisiaj',
};

export const PolishDatePickerProvider = ({ children }: { children: ReactNode }) => (
  <LocalizationProvider
    dateAdapter={AdapterDayjs}
    adapterLocale="pl"
    localeText={polishPickerLocaleText}
  >
    {children}
  </LocalizationProvider>
);

export const PolishDatePicker = ({
  id,
  label,
  value,
  onChange,
  required = false,
  error = false,
  helperText,
  inputRef,
  describedBy,
  sx,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: boolean;
  helperText?: string | undefined;
  inputRef?: Ref<HTMLInputElement>;
  describedBy?: string | undefined;
  sx?: SxProps<Theme>;
}) => (
  <DatePicker
    label={label}
    value={value ? dayjs(value) : null}
    onChange={(nextValue) => onChange(nextValue?.isValid() ? nextValue.format('YYYY-MM-DD') : '')}
    format="DD.MM.YYYY"
    slotProps={{
      field: {
        clearable: true,
        ...(id === undefined ? {} : { id }),
        ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
      },
      textField: {
        required,
        error,
        ...(id === undefined ? {} : { id }),
        ...(helperText === undefined ? {} : { helperText }),
        ...(inputRef === undefined ? {} : { inputRef }),
        ...(sx === undefined ? {} : { sx }),
        slotProps: {
          htmlInput: {
            ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
          },
          formHelperText: {
            ...(describedBy === undefined ? {} : { id: describedBy }),
          },
        },
      },
    }}
  />
);
