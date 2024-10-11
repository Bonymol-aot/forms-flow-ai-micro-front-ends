import React, { useState, useRef, useEffect } from 'react';
import { InputGroup } from 'react-bootstrap';
import ListGroup from 'react-bootstrap/ListGroup';
import { FormInput } from './FormInput';
import { CloseIcon , ChevronIcon } from "../SvgIcons/index";


interface DropdownItem {
  label: string;
  onClick: () => void;
}
interface InputDropdownProps {
  Options: DropdownItem[];
  firstItemLabel: string;
  dropdownLabel: string;
  placeholder?: string;
  isAllowInput: boolean;
  required?: boolean;
  value?: string;
  selectedOption?: string; 
}

export const InputDropdown: React.FC<InputDropdownProps> = ({
  Options = [],
  firstItemLabel,
  dropdownLabel,
  placeholder = '',
  isAllowInput,
  required = false,
  selectedOption 
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [inputValue, setInputValue] = useState<string>(selectedOption || ''); 
  const [filteredItems, setFilteredItems] = useState<DropdownItem[]>([]);
  const [textBoxInput, setTextBoxInput] = useState<boolean>(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => {
      setIsDropdownOpen((prev) => !prev);
  };

  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
              setIsDropdownOpen(false);
          }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => {
          document.removeEventListener('mousedown', handleClickOutside);
      };
  }, [dropdownRef]);

  useEffect(() => {
      
      if (selectedOption) {
          setInputValue(selectedOption);
      }
  }, [selectedOption]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputValue(value);

      const filtered = Options.filter((item) =>
          item.label.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredItems(filtered);
  };

  const handleSelect = (item: DropdownItem) => {
      setInputValue(item.label);
      setIsDropdownOpen(false);
      if (item.onClick) {
          item.onClick(); 
      }
  };

  const onFirstItemClick = () => {
      setTextBoxInput(true);
      setInputValue('');
      setIsDropdownOpen(false);
  };

  const handleClose = () => {
      setTextBoxInput(false);
      setInputValue('');
      setIsDropdownOpen(true);
  };

  return (
      <div ref={dropdownRef} className="input-dropdown">
          {textBoxInput ? (
              <InputGroup>
                  <FormInput
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      aria-label="category input"
                      icon={<CloseIcon onClick={handleClose} color='#253DF4' data-testid="close-input" aria-label="Close input "/>} 
                      className="input-with-close"
                      label={dropdownLabel}
                  />
              </InputGroup>
          ) : (
              <InputGroup>
                  <FormInput
                      placeholder={placeholder}
                      value={inputValue}
                      onChange={handleInputChange}
                      onClick={toggleDropdown}
                      aria-label="Dropdown input"
                      icon={<ChevronIcon data-testid="dropdown-input" aria-label="dropdown input"/>}
                      className={`${isDropdownOpen ? 'border-input collapsed' : ''}`}
                      onIconClick={toggleDropdown}
                      label={dropdownLabel}
                      required={required}
                  />
              </InputGroup>
          )}

          {!textBoxInput && isDropdownOpen && (
              <ListGroup>
                  {isAllowInput && (
                      <ListGroup.Item
                          onClick={onFirstItemClick}
                          className="list-first-item-btn"
                          data-testid="list-first-item"
                      >
                          {firstItemLabel}
                      </ListGroup.Item>
                  )}
                  {(filteredItems.length > 0 ? filteredItems : Options).map((item, index) => (
                      <ListGroup.Item
                          key={index}
                          onClick={() => handleSelect(item)}
                          data-testid={`list-${index}-item`}
                          aria-label={`list-${item.label}-item`}
                      >
                          {item.label}
                      </ListGroup.Item>
                  ))}
              </ListGroup>
          )}
      </div>
  );
};


