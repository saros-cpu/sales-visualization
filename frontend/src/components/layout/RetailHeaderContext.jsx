// src/components/layout/RetailHeaderContext.jsx — 零售 header 动态控件上下文
import { createContext, useContext, useState, useCallback } from 'react';

const RetailHeaderContext = createContext(null);

export function RetailHeaderProvider({ children }) {
  const [controls, setControls] = useState(null);

  const registerControls = useCallback((c) => setControls(c), []);
  const clearControls = useCallback(() => setControls(null), []);

  return (
    <RetailHeaderContext.Provider value={{ controls, registerControls, clearControls }}>
      {children}
    </RetailHeaderContext.Provider>
  );
}

export function useRetailHeader() {
  return useContext(RetailHeaderContext);
}
