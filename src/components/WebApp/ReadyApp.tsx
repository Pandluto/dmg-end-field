import App from '../../App';
import { AppProvider } from '../../context/AppContext';

export function ReadyApp({ cacheKey }: { cacheKey: string }) {
  return (
    <AppProvider>
      <App key={cacheKey} />
    </AppProvider>
  );
}
