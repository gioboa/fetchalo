import logo from './assets/logo.svg';

export default function App() {
  return (
    <section>
      <h2>Remote App</h2>
      <img data-testid="remote-logo" src={logo} alt="" width="32" />
    </section>
  );
}
