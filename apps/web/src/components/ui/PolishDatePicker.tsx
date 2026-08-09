import type { Ref } from 'react';
import dayjs from 'dayjs';
import type { SxProps, Theme } from '@mui/material/styles';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

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
