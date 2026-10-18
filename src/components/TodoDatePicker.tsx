import { useI18n } from "../hooks/useI18n";
import { DatePicker } from "./ui/DatePicker";

interface TodoDatePickerProps {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function TodoDatePicker(props: TodoDatePickerProps) {
  const { t, language } = useI18n();
  return <DatePicker {...props} locale={language} labels={{
    label: t("todo.dueDate"), year: t("todo.date.year"), month: t("todo.date.month"),
    day: t("todo.date.day"), clear: t("todo.date.clear"), today: t("todo.date.today"),
    tomorrow: t("todo.date.tomorrow"),
  }} />;
}
