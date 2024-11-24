import { createTheme, ThemeProvider } from '@mui/material/styles';
import { ConsolePage } from './pages/ConsolePage';
import './App.scss';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const App = () => (
  <ThemeProvider theme={darkTheme}>
    <ConsolePage />
  </ThemeProvider>
);

export default App;
