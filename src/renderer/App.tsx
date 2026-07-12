import { LaunchPage } from './launch/LaunchPage';

export function App() {
  return <LaunchPage api={window.writellm} />;
}
