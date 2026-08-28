// Mocks compartidos para tests
export const mockRequest = (body = {}, params = {}) => ({
  body,
  params,
});

export const mockResponse = () => {
  const res: any = {};
  res.statusCode = 200;
  res.status = function(code: number) {
    this.statusCode = code;
    return this;
  };
  res.json = function(data: any) {
    this.data = data;
    return this;
  };
  return res;
};
