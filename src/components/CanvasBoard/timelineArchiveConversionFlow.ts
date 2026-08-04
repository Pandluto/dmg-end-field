export type TimelineArchiveConversionOutcome<T> =
  | { status: 'reloading'; converted: T }
  | { status: 'conversion-failed'; error: unknown }
  | { status: 'activation-failed'; converted: T; error: unknown };

export async function runTimelineArchiveConversionForReload<T>(input: {
  convert: () => Promise<T>;
  activate: (converted: T) => void;
  reload: () => void;
}): Promise<TimelineArchiveConversionOutcome<T>> {
  let converted: T;
  try {
    converted = await input.convert();
  } catch (error) {
    return { status: 'conversion-failed', error };
  }

  try {
    input.activate(converted);
    input.reload();
    return { status: 'reloading', converted };
  } catch (error) {
    return { status: 'activation-failed', converted, error };
  }
}
