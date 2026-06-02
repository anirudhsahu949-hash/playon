import React, { createContext, useContext, ReactNode } from "react";
import { useColorScheme } from "react-native";
import { LightTheme, DarkTheme } from "./color";

type ThemeType = typeof LightTheme;

const AppThemeContext = createContext<ThemeType>(LightTheme);

type Props = {
  children: ReactNode;
};

export const AppThemeProvider = ({ children }: Props) => {
  const scheme = useColorScheme();

  const theme =
    scheme === "dark"
      ? DarkTheme
      : LightTheme;

  return (
    <AppThemeContext.Provider value={theme}>
      {children}
    </AppThemeContext.Provider>
  );
};

export const useAppTheme = () => {
  return useContext(AppThemeContext);
};